import Link from "next/link";

const link = "inline-flex min-h-11 items-center px-3 font-medium underline-offset-4 hover:underline";

export function Nav() {
  return (
    <nav aria-label="Main" className="-mx-3 mb-4 flex flex-wrap items-center">
      <Link href="/" className={link}>
        Journal
      </Link>
      <Link href="/capture" className={link}>
        Capture
      </Link>
      <Link href="/tags" className={link}>
        Tags
      </Link>
      <Link href="/deleted" className={link}>
        Deleted
      </Link>
      <a href="/api/export" className={link}>
        Export
      </a>
    </nav>
  );
}
