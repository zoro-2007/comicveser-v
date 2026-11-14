import SourceTitleReviewClient from "./SourceTitleReviewClient";

export default function Page({ params }: { params: { sourceId: string; externalId: string } }) {
  return <SourceTitleReviewClient params={params} />;
}
