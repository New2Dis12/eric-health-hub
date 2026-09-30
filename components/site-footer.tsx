import Link from 'next/link'

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 px-6 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>{`© ${new Date().getFullYear()} Eric Health Hub. Personal use only.`}</p>
        <div className="flex gap-6">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms of Service
          </Link>
        </div>
      </div>
    </footer>
  )
}
