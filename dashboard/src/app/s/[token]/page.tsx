import { redirect, notFound } from "next/navigation";
import { decodeShareLink } from "@/lib/shareLink";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = decodeShareLink(token);
  if (!payload?.s) return notFound();
  const qs = new URLSearchParams();
  if (payload.p) qs.set("project", payload.p);
  qs.set("session", payload.s);
  if (payload.n) qs.set("node", payload.n);
  if (payload.m) qs.set("mode", payload.m);
  redirect(`/?${qs.toString()}`);
}
