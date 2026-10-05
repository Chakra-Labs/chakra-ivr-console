import { currentViewer, unauthorized } from "@/lib/auth";

export async function GET() {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  return Response.json(
    viewer.role === "admin"
      ? { role: "admin", email: viewer.email }
      : { role: "company", email: viewer.email, licenseId: viewer.licenseId, companyName: viewer.companyName },
  );
}
