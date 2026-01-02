import React from 'react'

export default function AuthForm({ children, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="bg-white/5 p-6 rounded-md shadow-md">
      {children}
    </form>
  )
}
