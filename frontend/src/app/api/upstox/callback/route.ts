import axios from "axios";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    // Safe debug logging (no secrets)
    console.log("AUTH CODE present:", Boolean(code));
    console.log("CLIENT ID present:", Boolean(process.env.UPSTOX_CLIENT_ID));
    console.log(
      "CLIENT SECRET present:",
      Boolean(process.env.UPSTOX_CLIENT_SECRET)
    );

    if (!code) {
      return NextResponse.json(
        { error: "Authorization code missing" },
        { status: 400 }
      );
    }

    const redirectUri = process.env.UPSTOX_REDIRECT_URI;
    if (!redirectUri) {
      return NextResponse.json(
        { error: "Missing UPSTOX_REDIRECT_URI" },
        { status: 400 }
      );
    }

    const res = await axios.post(
      "https://api.upstox.com/v2/login/authorization/token",
      new URLSearchParams({
        code,
        client_id: process.env.UPSTOX_CLIENT_ID!,
        client_secret: process.env.UPSTOX_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const accessToken = res?.data?.access_token;
    if (accessToken) {
      await prisma.upstoxSession.create({
        data: { accessToken }
      });
    }

    return NextResponse.json(res.data);
  } catch (error: any) {
    console.error("Upstox token error:", error?.response?.data || error);

    return NextResponse.json(
      {
        error: "Upstox token exchange failed",
        details: error?.response?.data
      },
      { status: 500 }
    );
  }
}
