import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import * as stylex from "@stylexjs/stylex"
import type { StyleXStyles } from "@stylexjs/stylex"

const styles = stylex.create({
  base: { backgroundColor: "var(--border)", flexShrink: 0 },
  horizontal: { height: 1, width: "100%" },
  vertical: { alignSelf: "stretch", width: 1 },
})

function Separator({
  orientation = "horizontal",
  xstyle,
  ...props
}: SeparatorPrimitive.Props & { xstyle?: StyleXStyles }) {
  return (
    <SeparatorPrimitive
      orientation={orientation}
      {...stylex.props(
        styles.base,
        orientation === "horizontal" ? styles.horizontal : styles.vertical,
        xstyle,
      )}
      {...props}
    />
  )
}

export { Separator }
