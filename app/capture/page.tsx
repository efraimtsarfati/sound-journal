import { CaptureForm } from "./capture-form";

export const metadata = { title: "Capture · Sound Journal" };

export default async function CapturePage({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  const { url } = await searchParams;
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-xl font-semibold">Capture</h1>
      <CaptureForm initialUrl={url ?? ""} />
    </main>
  );
}
