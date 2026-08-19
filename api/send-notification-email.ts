/// <reference types="node" />

declare const process: { env: Record<string, string | undefined> }

type EmailPayload = {
  to: string | string[]
  subject: string
  text?: string
  html?: string
}

function normalizeRecipients(to: string | string[]) {
  return Array.isArray(to) ? to : [to]
}

function htmlToText(html?: string) {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    const { to, subject, text, html }: EmailPayload = req.body ?? {}
    if (!to || !subject) {
      return res.status(400).json({ ok: false, error: 'Missing to or subject' })
    }

    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: 'RESEND_API_KEY is not configured. Add it in your hosting environment.',
      })
    }

    if (!from) {
      return res.status(500).json({
        ok: false,
        error: 'EMAIL_FROM or RESEND_FROM_EMAIL is not configured. Add a verified sender address.',
      })
    }

    const payload = {
      from,
      to: normalizeRecipients(to),
      subject,
      text: text || htmlToText(html),
      html: html || `<p>${(text || htmlToText(html) || '').replace(/\n/g, '<br />')}</p>`,
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      console.error('Resend email failed:', data)
      return res.status(502).json({
        ok: false,
        error: 'Email provider rejected the request',
        details: data,
      })
    }

    return res.status(200).json({ ok: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Email send handler failed:', message)
    return res.status(500).json({ ok: false, error: 'Unexpected email error', details: message })
  }
}
