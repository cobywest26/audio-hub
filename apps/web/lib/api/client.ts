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

export async function getLatestMetrics(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/metrics/latest`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Failed to fetch latest metrics.");
  }

  return data;
}

export async function getSnapshots(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/metrics/snapshots`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Failed to fetch snapshots.");
  }

  return data;
}

export async function resetForNewSnapshot(accessToken: string) {
    const response = await fetch(`${API_BASE_URL}/metrics/reset`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.detail || "Failed to prepare for new snapshot.");
    }

    return data;
}
