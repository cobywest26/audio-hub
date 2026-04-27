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