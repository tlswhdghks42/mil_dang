import React from "react";
import { Pressable, StyleSheet, Text, ViewStyle } from "react-native";
import { tokens } from "../designTokens";

type Props = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  style?: ViewStyle;
};

export function LargeButton({ label, onPress, variant = "primary", style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.base,
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        variant === "danger" && styles.danger,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: tokens.touch.minHeight,
    minWidth: tokens.touch.minWidth,
    borderRadius: tokens.touch.radius,
    paddingVertical: tokens.touch.padding,
    paddingHorizontal: tokens.touch.padding,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 8,
  },
  label: {
    fontSize: tokens.font.xl,
    fontWeight: tokens.font.weightBold,
    color: "#FFFFFF",
  },
  primary: { backgroundColor: tokens.color.blue },
  secondary: { backgroundColor: tokens.color.gray },
  danger: { backgroundColor: tokens.color.red },
});
