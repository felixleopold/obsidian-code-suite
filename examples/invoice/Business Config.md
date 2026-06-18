---
biz_legal_name: "Muster IT-Services e.U."
biz_street: "Musterstraße 1"
biz_zip_city: "1010 Wien"
biz_email: "office@example.com"
biz_vat_id: "ATU12345678"
biz_iban: "AT00 1234 5678 9012 3456"
biz_bic: "GIBAATWWXXX"
biz_tax_note: "Gemäß § 6 Abs. 1 Z 27 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmer)."
---

# Business Config

Single source of truth for the details shared by every invoice. Any note that
declares `template_context: { biz: "[[Business Config]]" }` reads these
frontmatter keys as `{{ biz.biz_iban }}`, `{{ biz.biz_legal_name }}`, and so on.

Change a value here and **every** invoice that references it updates on its next
render — nothing is copied into the individual notes or the `invoice.html`
partial.
