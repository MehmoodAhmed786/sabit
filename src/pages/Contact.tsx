import React, { useState } from 'react'

export default function Contact() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    ;(async () => {
      try {
        const form = new FormData()
        form.append('name', name)
        form.append('email', email)
        form.append('message', message)
        form.append('_subject', `Sabit contact: ${name || email}`)

        const resp = await fetch('https://formsubmit.co/ajax/joblessveelawger786@gmail.com', {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: form,
        })

        const data = await resp.json().catch(() => null)
        if (!resp.ok) {
          const errMsg = data?.message || data?.error || 'Form submit failed'
          throw new Error(errMsg)
        }

        alert('Message sent — thank you!')
        setName('')
        setEmail('')
        setMessage('')
      } catch (err: any) {
        console.error('formsubmit error', err)
        alert('Failed to send message. Please try again later or email joblessveelawger786@gmail.com')
      }
    })()
  }

  return (
    <div className="page-content" style={{ paddingTop: 24 }}>
      <h2>Contact</h2>
      <p className="muted" style={{ maxWidth: 640 }}>
        We'd love to hear from you — feedback, bug reports, or ideas to improve Sabit.
        Use the form below to send us a message, or email us directly at <strong>joblessveelawger786@gmail.com</strong>.
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
