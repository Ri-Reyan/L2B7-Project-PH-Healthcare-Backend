import bcrypt from "bcryptjs";
import { JwtPayload, SignOptions } from "jsonwebtoken";
import { jwtUtils } from "../../utils/jwt";
import {
  IGoogleLoginPayload,
  ILoginUserPayload,
  IRegisterPatientPayload,
  IRequestUser,
} from "./auth.interface";
import {
  AuthProvider,
  Role,
  UserStatus,
} from "../../../../generated/prisma/enums";
import { googleClient } from "../../lib/googleAuth";
import { TokenPayload } from "google-auth-library";
import { prisma } from "../../lib/prisma";

const registerPatient = async (payload: IRegisterPatientPayload) => {
  const { name, password } = payload;
  const email = payload.email.trim().toLowerCase();

  const isUserExists = await prisma.user.findUnique({
    where: { email },
  });

  if (isUserExists) {
    throw new Error("User with this email already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 8);

  const createdUser = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: Role.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: false,
      patient: {
        create: { name, email },
      },
    },
    omit: { password: true },
    include: { patient: true },
  });

  const { patient, ...user } = createdUser;
  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET as string,
    process.env.JWT_ACCESS_EXPIRES_IN as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    process.env.JWT_REFRESH_SECRET as string,
    process.env.JWT_REFRESH_EXPIRES_IN as SignOptions,
  );

  return {
    user,
    patient,
    accessToken,
    refreshToken,
  };
};

const loginUser = async (payload: ILoginUserPayload) => {
  const { password } = payload;
  const email = payload.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new AppError("User not found", 400);
  }

  if (user.status === UserStatus.BLOCKED) {
    throw new AppError("User is blocked", 403);
  }

  if (user.isDeleted || user.status === UserStatus.DELETED) {
    throw new AppError("User is deleted", 400);
  }

  const isPasswordMatched = await bcrypt.compare(password, user.password);

  if (!isPasswordMatched) {
    throw new AppError("Invalid credentials", 403);
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET as string,
    process.env.JWT_ACCESS_EXPIRES_IN as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    process.env.JWT_REFRESH_SECRET as string,
    process.env.JWT_REFRESH_EXPIRES_IN as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const getMe = async (user: IRequestUser) => {
  const isUserExists = await prisma.user.findUnique({
    where: {
      id: user.userId,
    },
    include: {
      patient: true,
    },
    omit: {
      password: true,
    },
  });

  if (!isUserExists) {
    throw new AppError("User not found", 400);
  }

  return isUserExists;
};

const refreshToken = async (token: string) => {
  const verifiedRefreshToken = jwtUtils.verifyToken(
    token,
    process.env.JWT_REFRESH_SECRET as string,
  );

  if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
    throw new Error(
      process.env.NODE_ENV === "development"
        ? verifiedRefreshToken.error
        : "Invalid refresh token",
    );
  }

  const data = verifiedRefreshToken.data as JwtPayload;

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
  });

  if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
    throw new AppError("User is inactive or not found", 400);
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET as string,
    process.env.JWT_ACCESS_EXPIRES_IN as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    process.env.JWT_REFRESH_SECRET as string,
    process.env.JWT_REFRESH_EXPIRES_IN as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const googleService = async (payload: IGoogleLoginPayload) => {
  let googleIdPayload: TokenPayload | null | undefined = null;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: payload.idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    googleIdPayload = ticket.getPayload();
  } catch (error) {
    console.log("Google  id verification failed", error);
    throw new Error("Invalid or Expired Google Id Token");
  }

  if (!googleIdPayload) {
    throw new Error("Invalid or Expired Google Id Token");
  }

  const isPatientExitsWithGoogle = await prisma.user.findUnique({
    where: {
      email: googleIdPayload.email,
      role: Role.PATIENT,
      googleId: googleIdPayload.sub,
    },
  });

  let user = isPatientExitsWithGoogle;

  if (!isPatientExitsWithGoogle) {
    const ifPatientExitsWithCredentials = await prisma.user.findUnique({
      where: {
        email: googleIdPayload.email,
        role: Role.PATIENT,
        authProvider: AuthProvider.GOOGLE,
      },
    });

    user = ifPatientExitsWithCredentials;

    if (isPatientExitsWithGoogle) {
      if (user.status === UserStatus.BLOCKED) {
        throw new Error("User already blocked");
      }

      if (user.status === UserStatus.DELETED) {
        throw new Error("User already deleted");
      }

      const jwtPayload = {
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      };

      const accessToken = jwtUtils.createToken(
        jwtPayload,
        process.env.JWT_ACCESS_SECRET as string,
        process.env.JWT_ACCESS_EXPIRES_IN as SignOptions,
      );

      const refreshToken = jwtUtils.createToken(
        jwtPayload,
        process.env.JWT_REFRESH_SECRET as string,
        process.env.JWT_REFRESH_EXPIRES_IN as SignOptions,
      );

      return {
        accessToken,
        refreshToken,
      };
    }

    user = await prisma.user.create({
      data: {
        name: googleIdPayload.name,
        email: googleIdPayload.email,
        role: Role.PATIENT,
        googleId: googleIdPayload.sub,
        authProvider: AuthProvider.GOOGLE,
        emailVerified: true,
      },
      patient: {
        create: {
          name: googleIdPayload.name,
          email: googleIdPayload.email,
        },
      },
    });
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET as string,
    process.env.JWT_ACCESS_EXPIRES_IN as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    process.env.JWT_REFRESH_SECRET as string,
    process.env.JWT_REFRESH_EXPIRES_IN as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

export const AuthService = {
  registerPatient,
  loginUser,
  getMe,
  refreshToken,
  googleService,
};
