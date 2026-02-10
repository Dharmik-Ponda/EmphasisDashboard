import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const ADMIN_EMAILS = ["dharmikponda77@gmail.com"];

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || "";

  if (!email || !ADMIN_EMAILS.includes(email)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const accessToken = String(body?.accessToken || "").trim();

  if (!accessToken) {
    return NextResponse.json({ error: "Access token is required" }, { status: 400 });
  }

  await prisma.upstoxSession.deleteMany();
  await prisma.upstoxSession.create({ data: { accessToken } });

  return NextResponse.json({ ok: true });
}
