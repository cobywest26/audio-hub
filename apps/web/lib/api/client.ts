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

export async function getProfileMetrics(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/metrics/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Failed to fetch profile metrics.");
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

export async function renameSnapshot(
  accessToken: string,
  snapshotId: string,
  name: string
) {
  const response = await fetch(
    `${API_BASE_URL}/metrics/snapshots/${snapshotId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name }),
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.detail || data?.message || "Failed to rename snapshot");
  }

  return data;
}

// Fetches aggregate listening metrics across the latest snapshots from each user
export async function getGlobalMetrics(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/metrics/global`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Failed to fetch global metrics.");
  }

  return data;
}