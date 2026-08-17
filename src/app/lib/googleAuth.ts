import { OAuth2Client } from "google-auth-library";

export const googleClient = new OAuth2Client({
  client_id: process.env.GOOGLE_CLIENT_ID,
});
