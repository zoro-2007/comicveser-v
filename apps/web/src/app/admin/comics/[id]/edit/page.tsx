import EditComicClient from "./EditComicClient";

export default function Page({ params }: { params: { id: string } }) {
  return <EditComicClient params={params} />;
}
