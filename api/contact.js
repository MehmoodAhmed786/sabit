import sgMail from '@sendgrid/mail'
import nodemailer from 'nodemailer'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { name, email, message } = req.body || {}
    console.log('contact invoked', { hasName: !!name, hasEmail: !!email, messageLength: message ? message.length : 0 })
    if (!email || !message) return res.status(400).json({ error: 'Missing required fields' })

    const supportEmail = process.env.SUPPORT_EMAIL || 'joblessveelawger786@gmail.com'
    const subject = `Sabit contact: ${name || email}`
    const text = `${message}\n\n--\nName: ${name || ''}\nEmail: ${email}`

    if (process.env.SENDGRID_API_KEY) {
      console.log('contact: using SendGrid')
      sgMail.setApiKey(process.env.SENDGRID_API_KEY)
      const result = await sgMail.send({
        to: supportEmail,
        from: process.env.FROM_EMAIL || 'no-reply@sabit.app',
        subject,
        text,
      })
      console.log('contact: sendgrid result', Array.isArray(result) ? result.length : typeof result)
    } else if (process.env.SMTP_HOST) {
      console.log('contact: using SMTP', { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT || 587 })
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      })

      const info = await transporter.sendMail({
        to: supportEmail,
        from: process.env.FROM_EMAIL || process.env.SMTP_USER || 'no-reply@sabit.app',
        subject,
        text,
      })
      console.log('contact: smtp send info', { accepted: info.accepted, messageId: info.messageId })
    } else {
      console.log('contact: no provider configured')
      return res.status(500).json({ error: 'No email provider configured (SENDGRID_API_KEY or SMTP_HOST required)' })
    }

    console.log('contact: message sent successfully')
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('contact api error', err)
    const detail = err && err.message ? String(err.message) : 'Failed to send message'
    return res.status(500).json({ error: 'Failed to send message', detail })
  }
}
