import CreatorComicClient from "./CreatorComicClient";

export default function Page({ params }: { params: { id: string } }) {
  return <CreatorComicClient params={params} />;
}
