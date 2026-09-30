import type { Metadata } from 'next'
import { LegalPage } from '@/components/legal-page'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Eric Health Hub collects, uses, and protects health data from connected services like Oura.',
}

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated="September 30, 2026"
      intro="Eric Health Hub is a personal project used by a single individual to view and organize their own health data. This policy explains what data is accessed, how it is used, and how it is protected."
      sections={[
        {
          heading: 'Information we access',
          body: (
            <>
              <p>
                When you connect an Oura account, Eric Health Hub requests read-only access to the data categories you
                approve on Oura&apos;s consent screen. This may include personal info (age, weight, height), daily
                summaries (sleep, readiness, activity), heart rate, workouts, sessions, and SpO2.
              </p>
              <p>We never receive or store your Oura account password.</p>
            </>
          ),
        },
        {
          heading: 'How we use information',
          body: (
            <p>
              Data is used solely to display personal health trends and insights to the account owner. It is not used
              for advertising, profiling, or any automated decision-making, and it is never sold.
            </p>
          ),
        },
        {
          heading: 'Storage and security',
          body: (
            <p>
              OAuth access and refresh tokens are stored in secure, HTTP-only cookies that are not accessible to
              client-side scripts. All traffic is encrypted over HTTPS. Health data is fetched on demand from Oura and
              is not retained beyond what is needed to render a page.
            </p>
          ),
        },
        {
          heading: 'Sharing',
          body: (
            <p>
              Eric Health Hub does not share data with third parties, except for infrastructure providers (such as
              the hosting platform) that process requests on our behalf, or where required by law.
            </p>
          ),
        },
        {
          heading: 'Your choices',
          body: (
            <p>
              You can revoke Eric Health Hub&apos;s access at any time from your Oura account settings under
              connected apps. Clearing your browser cookies for this site also removes stored tokens.
            </p>
          ),
        },
        {
          heading: 'Contact',
          body: (
            <p>
              Questions about this policy can be sent to the site owner at{' '}
              <a href="mailto:privacy@erichealthhub.com" className="text-foreground underline underline-offset-4">
                privacy@erichealthhub.com
              </a>
              .
            </p>
          ),
        },
      ]}
    />
  )
}
