import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Manual from './pages/Manual'
import FaceRecognition from './pages/FaceRecognition'
import Patrol from './pages/Patrol'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard/></ProtectedRoute>} />
      <Route path="/manual" element={<ProtectedRoute><Manual /></ProtectedRoute>} />
      <Route path="/patrol" element={<ProtectedRoute><Patrol /></ProtectedRoute>} />
      <Route path="/face-recognition" element={<ProtectedRoute><FaceRecognition /></ProtectedRoute>} />
    </Routes>
  )
}
