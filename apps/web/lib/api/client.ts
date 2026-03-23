export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

export async function uploadSpotifyData(
  file: File,
  accessToken: string
) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/upload/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Upload failed.");
  }

  return data;
}

export async function getMyMetrics(userId: string, accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/metrics/${userId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Failed to fetch metrics.");
  }

  return data;
}