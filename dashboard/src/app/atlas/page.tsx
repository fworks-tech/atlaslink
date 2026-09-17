// ?session/?project/?q/?mode drive UI — must not be prerendered as static (see #7, #64). force-dynamic busts Vercel edge cache for deep-links; keep single knob (revalidate/fetchCache implied).
export const dynamic = "force-dynamic";

import HomeClient from "../HomeClient";
import DemoBanner from "@/components/DemoBanner";

export default function Page() {
  return (
    <>
      <DemoBanner />
      <HomeClient />
    </>
  );
}
