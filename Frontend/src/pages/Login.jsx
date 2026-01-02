import { useState } from "react";
import { login } from '../services/authService'
import { useNavigate } from 'react-router-dom';
import Navbar from "../components/Navbar";

// real `login` imported from services/authService

//component for redirection to dashboard



// Component for the animated starfield and meteor background
const Starfield = () => {
  const starfieldStyles = `
    @keyframes move-stars {
      from { transform: translateY(0px); }
      to { transform: translateY(-2000px); }
    }
    @keyframes meteor-fall {
        0% {
            transform: translate3d(500px, -300px, 0) rotate(215deg);
            opacity: 1;
        }
        70% {
            opacity: 1;
        }
        100% {
            transform: translate3d(-2000px, 2000px, 0) rotate(215deg);
            opacity: 0;
        }
    }

    .stars-bg {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 200%;
      display: block;
      z-index: 0;
    }

    .stars1 {
      background: transparent url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><circle fill="%23fff" cx="200" cy="200" r="1.5"/><circle fill="%23fff" cx="500" cy="800" r="1"/><circle fill="%23fff" cx="900" cy="300" r="1.2"/><circle fill="%23fff" cx="1200" cy="1100" r="1"/><circle fill="%23fff" cx="1500" cy="600" r="1.5"/><circle fill="%23fff" cx="1800" cy="1400" r="0.8"/><circle fill="%23fff" cx="100" cy="1500" r="1.1"/><circle fill="%23fff" cx="800" cy="1800" r="1.3"/><circle fill="%23fff" cx="1300" cy="100" r="1"/><circle fill="%23fff" cx="1600" cy="900" r="0.9"/></svg>');
      animation: move-stars 150s linear infinite;
    }
    .stars2 {
      background: transparent url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><circle fill="%23fff" cx="300" cy="500" r="1"/><circle fill="%23fff" cx="600" cy="100" r="1.2"/><circle fill="%23fff" cx="1000" cy="900" r="0.8"/><circle fill="%23fff" cx="1400" cy="1300" r="1.5"/><circle fill="%23fff" cx="1700" cy="200" r="1.1"/><circle fill="%23fff" cx="400" cy="1600" r="1.3"/><circle fill="%23fff" cx="900" cy="1900" r="0.7"/><circle fill="%23fff" cx="1100" cy="1500" r="1.4"/><circle fill="%23fff" cx="1900" cy="800" r="1"/></svg>');
      animation: move-stars 100s linear infinite;
    }
    .stars3 {
      background: transparent url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><circle fill="%23fff" cx="100" cy="600" r="0.8"/><circle fill="%23fff" cx="400" cy="200" r="1"/><circle fill="%23fff" cx="800" cy="1100" r="1.2"/><circle fill="%23fff" cx="1100" cy="1600" r="0.9"/><circle fill="%23fff" cx="1500" cy="300" r="1.1"/><circle fill="%23fff" cx="1900" cy="1200" r="1.3"/><circle fill="%23fff" cx="250" cy="1800" r="0.7"/><circle fill="%23fff" cx="700" cy="1400" r="1.4"/><circle fill="%23fff" cx="1300" cy="700" r="1"/></svg>');
      animation: move-stars 50s linear infinite;
    }

    .meteor {
        position: absolute;
        width: 300px;
        height: 1px;
        background: linear-gradient(to right, rgba(255, 255, 255, 0.8), transparent);
        animation: meteor-fall 8s linear infinite;
    }
  `;

  return (
    <>
      <style>{starfieldStyles}</style>
      <div className="stars-bg stars1"></div>
      <div className="stars-bg stars2"></div>
      <div className="stars-bg stars3"></div>
      <div className="meteor" style={{ top: '100px', left: '-200px', animationDelay: '0s' }}></div>
      <div className="meteor" style={{ top: '300px', left: '0px', animationDelay: '1.4s' }}></div>
      <div className="meteor" style={{ top: '500px', left: '200px', animationDelay: '5.8s' }}></div>
    </>
  );
};

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await login(username, password);
      // store under 'access_token' to match ProtectedRoute and other parts
      localStorage.setItem('access_token', data.access_token);
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid username or password!')
    } finally {
      setLoading(false);
    }
  };
  
  const auraFontStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&display=swap');
    .font-aura {
        font-family: 'Orbitron', sans-serif;
        letter-spacing: 0.2em;
        text-shadow: 0 0 10px rgba(255, 255, 255, 0.3), 0 0 20px rgba(255, 255, 255, 0.3);
    }
  `;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black p-4 pt-20 relative overflow-hidden">
      <style>{auraFontStyles}</style>
      <Starfield />

      <Navbar />

      <div className="z-10 text-center mb-10">
        <h1 className="text-8xl font-black text-white font-aura select-none">AURA</h1>
      </div>

      <div className="w-full max-w-sm bg-white/10 backdrop-blur-md p-8 rounded-2xl shadow-2xl space-y-6 z-10 border border-white/20">
        
        <div className="text-center">
            <h2 className="text-2xl font-bold text-white">Sign In</h2>
            <p className="text-gray-400 mt-1">Enter your credentials to continue</p>
        </div>

        {error && <p className="text-red-400 text-sm text-center bg-red-500/20 border border-red-500/30 p-3 rounded-lg">{error}</p>}
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Username"
              className="w-full bg-white/5 border border-white/20 rounded-lg p-3 pl-10 text-white placeholder-gray-400 focus:ring-2 focus:ring-white/50 focus:border-transparent transition"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="odd" />
                </svg>
            </span>
            <input
              type="password"
              placeholder="Password"
              className="w-full bg-white/5 border border-white/20 rounded-lg p-3 pl-10 text-white placeholder-gray-400 focus:ring-2 focus:ring-white/50 focus:border-transparent transition"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-black rounded-lg p-3 font-semibold hover:bg-opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black focus:ring-white transition-all duration-300 shadow-lg hover:shadow-white/20 disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {loading ? (
                 <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            ) : (
                'Login'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

