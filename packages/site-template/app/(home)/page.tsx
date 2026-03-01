import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="max-w-2xl space-y-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          {"{{projectName}}"}
        </h1>
        <p className="text-lg text-fd-muted-foreground">
          Auto-generated documentation powered by AI
        </p>
        <div className="flex justify-center gap-4">
          <Link
            href="/docs"
            className="rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
          >
            Read the Docs
          </Link>
        </div>
      </div>
    </main>
  );
}
