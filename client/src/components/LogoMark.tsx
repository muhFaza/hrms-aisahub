// Brand mark: teal rounded square with a white "A" — no image files.
export default function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size * 0.28,
        background: '#0F766E',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: size * 0.55,
        lineHeight: 1,
      }}
    >
      A
    </div>
  );
}
