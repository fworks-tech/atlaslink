import { redirect } from "next/navigation";

export default async function ProjectSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; sessionId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { projectId, sessionId } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  qs.set("project", projectId);
  qs.set("session", sessionId);
  if (sp.node) qs.set("node", sp.node);
  if (sp.mode) qs.set("mode", sp.mode);
  redirect(`/?${qs.toString()}`);
}
