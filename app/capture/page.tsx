import { CaptureForm } from "./capture-form";

export const metadata = { title: "Capture · Sound Journal" };

export default async function CapturePage({ searchParams }: { searchParams: Promise<{ url?: string | string[] }> }) {
  const params = await searchParams;
  const url = Array.isArray(params.url) ? params.url[0] : params.url;
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-xl font-semibold">Capture</h1>
      <CaptureForm initialUrl={url ?? ""} />
    </main>
  );
}
