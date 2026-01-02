import { Navigate } from 'react-router-dom';

export default function ProtectedRoute({ children }) {
  // frontend stores access token under 'access_token'
  const token = localStorage.getItem('access_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}