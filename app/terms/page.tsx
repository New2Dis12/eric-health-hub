import type { Metadata } from 'next'
import { LegalPage } from '@/components/legal-page'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms governing the use of Eric Health Hub, a personal health data integration site.',
}

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="September 30, 2026"
      intro="By using Eric Health Hub, you agree to the following terms. Please read them carefully."
      sections={[
        {
          heading: 'Personal use',
          body: (
            <p>
              Eric Health Hub is a personal, non-commercial project intended for use by its owner to view their own
              health data. Access by others is not offered or supported.
            </p>
          ),
        },
        {
          heading: 'Not medical advice',
          body: (
            <p>
              Information displayed on this site is for general informational purposes only. It is not a substitute
              for professional medical advice, diagnosis, or treatment. Always consult a qualified healthcare
              provider with questions about a medical condition.
            </p>
          ),
        },
        {
          heading: 'Third-party services',
          body: (
            <p>
              This site connects to third-party services such as Oura. Your use of those services is governed by
              their own terms and privacy policies. Eric Health Hub is not affiliated with or endorsed by Oura Health
              Oy.
            </p>
          ),
        },
        {
          heading: 'Acceptable use',
          body: (
            <p>
              You agree not to misuse the site, attempt to gain unauthorized access to it, or interfere with its
              operation or the APIs it relies on.
            </p>
          ),
        },
        {
          heading: 'Disclaimer and limitation of liability',
          body: (
            <p>
              The site is provided &quot;as is&quot; without warranties of any kind. To the fullest extent permitted
              by law, the owner is not liable for any damages arising from use of the site or reliance on the data it
              displays.
            </p>
          ),
        },
        {
          heading: 'Changes',
          body: (
            <p>
              These terms may be updated from time to time. Continued use of the site after changes take effect
              constitutes acceptance of the revised terms.
            </p>
          ),
        },
      ]}
    />
  )
}
