import { Screen } from '../../../components/screen';
import { PACKET_IDS } from '../../../lib/pages';

// Sample packets are pre-rendered; a real test window's packet (its uuid) renders on demand.
export const dynamicParams = true;
export function generateStaticParams() {
  return PACKET_IDS.map((id) => ({ id }));
}
export const metadata = { title: 'Verification packet · Coversight Demo' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Screen page="packet" id={id} />;
}
