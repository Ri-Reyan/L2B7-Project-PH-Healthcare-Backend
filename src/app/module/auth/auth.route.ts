import { Router } from "express";
import { Role } from "../../../../generated/prisma/enums";
import { AuthController } from "./auth.controllers";
import { auth } from "../../middleware/checkAuth";

const router = Router();

router.post("/register", AuthController.registerPatient);
router.post("/login", AuthController.loginUser);
router.get(
  "/me",
  auth(Role.ADMIN, Role.DOCTOR, Role.PATIENT, Role.SUPER_ADMIN),
  AuthController.getMe,
);
router.post("/google", AuthController.googleLogin);
router.post("/refresh-token", AuthController.refreshToken);
export const AuthRoutes = router;
