import React, { useState } from 'react'

export default function Contact() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const to = 'support@sabit.app'
    const subject = encodeURIComponent('Sabit feedback from ' + (name || email || 'web'))
    const body = encodeURIComponent(`${message}

Name: ${name}
Email: ${email}`)
      ;(async () => {
        try {
          const resp = await fetch('/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, message }),
          })
          if (!resp.ok) throw new Error('send-failed')
          alert('Message sent — thank you!')
          setName('')
          setEmail('')
          setMessage('')
        } catch (err) {
          console.error(err)
          alert('Failed to send message. Please try again later or email support@sabit.app')
        }
      })()
  }

  return (
    <div className="page-content" style={{ paddingTop: 24 }}>
      <h2>Contact</h2>
      <p className="muted" style={{ maxWidth: 640 }}>
        We'd love to hear from you — feedback, bug reports, or ideas to improve Sabit.
        Use the form below to open your email client, or email us directly at <strong>support@sabit.app</strong>.
      </p>

      <form className="contact-form" onSubmit={handleSubmit} style={{ maxWidth: 640, marginTop: 16 }}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </label>

        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </label>

        <label>
          Message
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="How can we help?" />
        </label>

        <div style={{ marginTop: 12 }}>
          <button type="submit" className="btn">Send Email</button>
        </div>
      </form>
    </div>
  )
}
