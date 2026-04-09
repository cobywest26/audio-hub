import Image from "next/image";

export default function ProcessingPage() {
  return (
    <main className="audiohub-page">
      <div className="audiohub-stage audiohub-stage--center">
        <div className="audiohub-center-card">
          <Image
            src="/audiohub-logo.png"
            alt="AudioHub"
            width={62}
            height={62}
            className="audiohub-logo-large"
          />
          <div className="audiohub-processing-box">Processing...</div>
        </div>
      </div>
    </main>
  );
}

/*export default function ProcessingPage() {
  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-white">
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center pt-32 text-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-700 border-t-white" />
        <h1 className="mt-6 text-3xl font-bold">Processing your listening history</h1>
        <p className="mt-3 max-w-lg text-zinc-300">
          We’re parsing your Spotify data and building your first metrics snapshot.
        </p>
      </div>
    </main>
  );
}*/