import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  useWindowDimensions,
} from "react-native";

type PianoKey = {
  name: string; // e.g. "C4"
  label: string; // e.g. "C"
  frequency: number;
  isSharp: boolean;
  /** index of this white key from left (0-based) */
  whiteIndex?: number;
  /** position in "white key units" from left (for black keys) */
  positionInWhiteUnits?: number;
};

type WebAudioContext = AudioContext | null;

// ----- constants for layout -----
const KEY_HEIGHT = 160;
const WHITE_KEY_WIDTH = 56;
const BLACK_KEY_HEIGHT = KEY_HEIGHT * 0.6;
const BLACK_KEY_WIDTH = WHITE_KEY_WIDTH * 0.6;
const OCTAVES = [3, 4, 5] as const; // low, middle, high C-major octaves

// note names within one octave (12 semitones)
const NOTE_ORDER: string[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

// position of black keys within an octave, measured in "white key width" units
// 0 = left edge of C, 1 = left edge of D, etc.
function blackPositionInOctave(step: string): number {
  switch (step) {
    case "C#":
      return 0.75;
    case "D#":
      return 1.75;
    case "F#":
      return 3.75;
    case "G#":
      return 4.75;
    case "A#":
      return 5.75;
    default:
      return 0;
  }
}

// convert note name + octave to MIDI number (for frequency calculation)
function midiNumber(note: string, octave: number): number {
  const indexInOctave = NOTE_ORDER.indexOf(note);
  // MIDI formula: C-1 = 0, so C0 = 12; A4 = 69
  return 12 * (octave + 1) + indexInOctave;
}

// equal temperament frequency from MIDI number
function frequencyFromMidi(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// build 3-octave piano key definitions:
// low C〜B（C3〜B3）, middle C〜B（C4〜B4）, high C〜B（C5〜B5）
function buildPianoKeys(): PianoKey[] {
  const keys: PianoKey[] = [];
  let globalWhiteIndex = 0;

  OCTAVES.forEach((octave, octaveIdx) => {
    // white key index within the octave: C=0, D=1, ... B=6
    let whiteIndexInOctave = 0;

    NOTE_ORDER.forEach((noteName) => {
      const isSharp = noteName.includes("#");
      const midi = midiNumber(noteName, octave);
      const freq = frequencyFromMidi(midi);
      const fullName = `${noteName}${octave}`;

      if (isSharp) {
        // black key: position between white keys in this octave
        const posInOctave = blackPositionInOctave(noteName);
        const positionInWhiteUnits = octaveIdx * 7 + posInOctave;
        keys.push({
          name: fullName,
          label: noteName,
          frequency: freq,
          isSharp: true,
          positionInWhiteUnits,
        });
      } else {
        // white key
        const whiteIndex = globalWhiteIndex;
        keys.push({
          name: fullName,
          label: noteName,
          frequency: freq,
          isSharp: false,
          whiteIndex,
        });
        globalWhiteIndex += 1;
        whiteIndexInOctave += 1;
      }
    });
  });

  return keys;
}

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const [lastNote, setLastNote] = useState<string | null>(null);
  const [isWebSupported, setIsWebSupported] = useState<boolean>(true);
  const audioContextRef = useRef<WebAudioContext>(null);

  const isWeb = Platform.OS === "web";

  const allKeys = useMemo(() => buildPianoKeys(), []);
  const whiteKeys = useMemo(
    () =>
      allKeys
        .filter((k) => !k.isSharp)
        .sort((a, b) => (a.whiteIndex ?? 0) - (b.whiteIndex ?? 0)),
    [allKeys]
  );
  const blackKeys = useMemo(
    () =>
      allKeys
        .filter((k) => k.isSharp)
        .sort(
          (a, b) =>
            (a.positionInWhiteUnits ?? 0) - (b.positionInWhiteUnits ?? 0)
        ),
    [allKeys]
  );

  const totalWhiteKeys = whiteKeys.length;
  const keyboardWidth = totalWhiteKeys * WHITE_KEY_WIDTH;
  const isNarrow = width < 480;

  // Create AudioContext lazily on first user interaction
  const ensureAudioContext = useCallback(() => {
    if (!isWeb) return null;

    if (!audioContextRef.current) {
      const AudioContextCtor =
        (window as any).AudioContext || (window as any).webkitAudioContext;

      if (!AudioContextCtor) {
        setIsWebSupported(false);
        return null;
      }

      audioContextRef.current = new AudioContextCtor();
    }

    setIsWebSupported(true);
    return audioContextRef.current;
  }, [isWeb]);

  const playNote = useCallback(
    (key: PianoKey) => {
      setLastNote(key.name);

      if (!isWeb) {
        return;
      }

      const ctx = ensureAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(key.frequency, now);

      // Simple attack / decay envelope
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.5, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.6);
    },
    [ensureAudioContext, isWeb]
  );

  // Close audio context on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        <Text style={styles.title}>Browser Piano</Text>
        {!isWeb && (
          <Text style={styles.warning}>
            You are not on a web browser. Sound playback is disabled, but the
            piano keys are still interactive.
          </Text>
        )}

        {isWeb && !isWebSupported && (
          <Text style={styles.warning}>
            Your browser does not seem to support the Web Audio API. Please try
            a modern browser such as the latest Chrome, Edge, or Firefox.
          </Text>
        )}

        <View style={styles.statusArea}>
          <Text style={styles.statusLabel}>Now playing:</Text>
          <Text style={styles.statusValue}>
            {lastNote ?? "No note yet"}
          </Text>
        </View>

        <View style={styles.keyboardContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
              styles.keyboardScrollContent,
              isNarrow && { paddingHorizontal: 12 },
            ]}
          >
            <View
              style={[
                styles.keyboardInner,
                {
                  width: keyboardWidth,
                  height: KEY_HEIGHT,
                },
              ]}
            >
              {/* White keys: base layer */}
              {whiteKeys.map((key) => (
                <Pressable
                  key={key.name}
                  onPress={() => playNote(key)}
                  style={({ pressed }) => [
                    styles.whiteKey,
                    {
                      left: (key.whiteIndex ?? 0) * WHITE_KEY_WIDTH,
                      width: WHITE_KEY_WIDTH,
                    },
                    pressed && styles.whiteKeyPressed,
                  ]}
                >
                  <Text style={styles.whiteKeyLabel}>{key.label}</Text>
                </Pressable>
              ))}

              {/* Black keys: overlaid, narrower, on top of white keys */}
              {blackKeys.map((key) => {
                const posUnits = key.positionInWhiteUnits ?? 0;
                const left = posUnits * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2;
                return (
                  <Pressable
                    key={key.name}
                    onPress={() => playNote(key)}
                    style={({ pressed }) => [
                      styles.blackKey,
                      {
                        left,
                        width: BLACK_KEY_WIDTH,
                        height: BLACK_KEY_HEIGHT,
                      },
                      pressed && styles.blackKeyPressed,
                    ]}
                  >
                    <Text style={styles.blackKeyLabel}>{key.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f5f5f7",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    width: "100%",
    maxWidth: 640,
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
    color: "#111827",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    color: "#4b5563",
  },
  warning: {
    fontSize: 13,
    textAlign: "center",
    color: "#b91c1c",
    backgroundColor: "#fee2e2",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusArea: {
    alignItems: "center",
    gap: 4,
  },
  statusLabel: {
    fontSize: 13,
    color: "#6b7280",
  },
  statusValue: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  keyboardContainer: {
    borderRadius: 16,
    backgroundColor: "#e5e7eb",
    paddingVertical: 12,
    paddingHorizontal: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 4,
  },
  keyboardScrollContent: {
    paddingVertical: 4,
  },
  keyboardInner: {
    position: "relative",
  },
  whiteKey: {
    position: "absolute",
    bottom: 0,
    height: KEY_HEIGHT,
    borderRadius: 8,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#d1d5db",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 8,
  },
  whiteKeyPressed: {
    backgroundColor: "#e5e7eb",
  },
  whiteKeyLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#111827",
  },
  blackKey: {
    position: "absolute",
    top: 0,
    borderRadius: 6,
    backgroundColor: "#111827",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 6,
    zIndex: 2,
  },
  blackKeyPressed: {
    backgroundColor: "#374151",
  },
  blackKeyLabel: {
    fontSize: 10,
    fontWeight: "500",
    color: "#f9fafb",
  },
  footer: {
    marginTop: 8,
  },
  footerText: {
    fontSize: 12,
    textAlign: "center",
    color: "#6b7280",
  },
});
