import SourceCatalogClient from "./SourceCatalogClient";



export default function Page({ params }: { params: { sourceId: string } }) {
  return <SourceCatalogClient params={params} />;
}
