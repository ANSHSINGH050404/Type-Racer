import { RaceRoom } from "@/components/RaceRoom";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function RacePage({ params }: Props) {
  const { id } = await params;

  return (
    <main className="flex flex-1 flex-col px-4 py-10 sm:py-14">
      <RaceRoom roomId={id} />
    </main>
  );
}
