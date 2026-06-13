import { Link } from "react-router-dom";
import { PageShell } from "@/components/layout/Layout";
import { PulseDot } from "@/components/widgets";

export default function NotFound() {
  return (
    <PageShell>
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <PulseDot className="mb-6" />
        <h1 className="num mb-2 text-5xl font-semibold tracking-tight">404</h1>
        <p className="mb-6 max-w-sm text-sm text-mute">
          No signal here. This page isn't in any of our five sources.
        </p>
        <Link
          to="/"
          className="rounded-xl2 bg-accent px-4 py-2 text-sm font-medium text-white transition-transform hover:scale-[1.02]"
        >
          Back to the pulse
        </Link>
      </div>
    </PageShell>
  );
}
