import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { register as registerUser } from '../services/authService'
import AuthForm from '../components/AuthForm'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await registerUser(email, password, phone)
      navigate('/login')
    } catch (err) {
      setError(err.response?.data?.detail || 'Registration failed')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <AuthForm onSubmit={handleSubmit}>
          <h2 className="text-center text-2xl font-bold mb-4">Register</h2>
          {error && <div className="mb-4 text-red-600 bg-red-50 p-2 rounded">{error}</div>}
          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2">Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" />
          </div>
          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2">Phone (optional)</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" />
          </div>
          <div className="mb-6">
            <label className="block text-gray-700 text-sm font-bold mb-2">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" />
          </div>
          <div className="flex items-center justify-between">
            <button className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded" type="submit">Create Account</button>
          </div>
        </AuthForm>
      </div>
    </div>
  )
}
