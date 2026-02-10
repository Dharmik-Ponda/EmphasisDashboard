import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = body?.name?.trim();
  const email = body?.email?.toLowerCase().trim();
  const phone = body?.phone?.trim();
  const password = body?.password || "";

  if (!email || !password || !phone) {
    return NextResponse.json({ error: "Email, phone, and password are required" }, { status: 400 });
  }

  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length !== 10) {
    return NextResponse.json({ error: "Phone number must be 10 digits" }, { status: 400 });
  }

  const strong =
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
  if (!strong) {
    return NextResponse.json(
      { error: "Password must be 8+ chars with uppercase, lowercase, number, and symbol" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "User already exists" }, { status: 409 });
  }

  const hash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { name, email, phone: `+91${phoneDigits}`, password: hash }
  });

  return NextResponse.json({ ok: true });
}
