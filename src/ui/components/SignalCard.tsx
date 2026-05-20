import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SignalLevel } from "../../domain/types";
import { tokens } from "../designTokens";

const levelMap: Record<SignalLevel, { icon: string; bg: string }> = {
  critical_low: { icon: "🆘", bg: "#FFCDD2" },
  low: { icon: "🔵", bg: "#E3F2FD" },
  green: { icon: "🟢", bg: "#E8F5E9" },
  yellow: { icon: "🟡", bg: "#FFF8E1" },
  red: { icon: "🔴", bg: "#FFEBEE" },
};

export function SignalCard({ level, message }: { level: SignalLevel; message: string }) {
  useEffect(() => {
    // TODO: trigger haptic feedback + status sound + slow/clear TTS output.
  }, [level, message]);

  return (
    <View style={[styles.card, { backgroundColor: levelMap[level].bg }]}>
      <Text style={styles.icon}>{levelMap[level].icon}</Text>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 24, marginVertical: 12 },
  icon: { fontSize: 48, marginBottom: 12, textAlign: "center" },
  text: {
    fontSize: tokens.font.xl,
    lineHeight: 40,
    color: tokens.color.text,
    fontWeight: "700",
  },
});
