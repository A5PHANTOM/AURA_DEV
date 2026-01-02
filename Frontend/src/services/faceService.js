import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

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
