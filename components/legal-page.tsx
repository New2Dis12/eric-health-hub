type LegalSection = {
  heading: string
  body: React.ReactNode
}

export function LegalPage({
  title,
  lastUpdated,
  intro,
  sections,
}: {
  title: string
  lastUpdated: string
  intro: string
  sections: LegalSection[]
}) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <p className="text-sm text-muted-foreground">Last updated {lastUpdated}</p>
      <h1 className="mt-2 text-balance text-4xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">{intro}</p>
      <div className="mt-12 flex flex-col gap-10">
        {sections.map((section, index) => (
          <section key={section.heading} aria-labelledby={`section-${index}`}>
            <h2 id={`section-${index}`} className="text-lg font-semibold">
              {`${index + 1}. ${section.heading}`}
            </h2>
            <div className="mt-3 flex flex-col gap-3 leading-relaxed text-muted-foreground">
              {section.body}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
