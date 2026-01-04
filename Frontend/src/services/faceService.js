import axios from 'axios';

// Backend base URL shared by face recognition, people, and analytics.
// Priority:
// 1) VITE_API_BASE (for custom setups)
// 2) Same host as the frontend (works on LAN/mobile) on port 8000
export const API_URL =
  import.meta.env.VITE_API_BASE ||
  `http://${window.location.hostname}:8000`;

export async function runFaceRecognition(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await axios.post(`${API_URL}/face-recognition`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data; // { count, detections }
}

export async function registerPerson(name, file) {
  const formData = new FormData();
  formData.append('name', name);
  formData.append('file', file);

  const response = await axios.post(`${API_URL}/people`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data; // { id, name, image_url }
}

export async function listPeople() {
  const response = await axios.get(`${API_URL}/people`);
  return response.data; // [{ id, name, image_url }]
}

export async function deletePerson(id) {
  const response = await axios.delete(`${API_URL}/people/${id}`);
  return response.data; // { status, id }
}
