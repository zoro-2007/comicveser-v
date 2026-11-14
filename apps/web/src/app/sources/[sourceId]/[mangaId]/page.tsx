import SourceMangaClient from "./SourceMangaClient";


export default function Page({ params }: { params: { sourceId: string; mangaId: string } }) {
  return <SourceMangaClient params={params} />;
}
