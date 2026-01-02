import axios from 'axios';
// In Vite, use import.meta.env for environment variables (process is not available in the browser)
const API_URL = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export async function login(username, password) {
    // OAuth2 Password flow on the backend expects form-encoded data
    const fd = new URLSearchParams();
    fd.append('username', username);
    fd.append('password', password);

    const response = await axios.post(`${API_URL}/auth/login`, fd, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.data;
}

export async function register(email, password, phone_number) {
    const response = await axios.post(`${API_URL}/auth/register`, {
        email,
        password,
        phone_number,
    });
    return response.data;
}