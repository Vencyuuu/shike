// 从先前构建缓存恢复的等价模块，已移除 Metro 外壳并恢复 JSX。
import * as React from "react";
import * as RN from "react-native";
import { LocalPhoto } from "./LocalPhoto";
import { useReducedMotion } from "./MotionView";
/** 横向切图；内部双指缩放独立处理，避免缩放时误触翻页。 */
function PhotoViewer({ photos, selectedId, uri, onSelect, onRepair }) {
  const reducedMotion = useReducedMotion();
  const list = React.useRef(null);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const { width, height } = viewport;
  const index = Math.max(
    0,
    photos.findIndex((photo) => photo.id === selectedId),
  );
  React.useEffect(() => {
    if (width)
      list.current?.scrollToOffset({
        offset: index * width,
        animated: !reducedMotion,
      });
  }, [index, width, reducedMotion]);
  return (
    <RN.View
      style={s.root}
      onLayout={(event) =>
        setViewport({
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        })
      }
    >
      {!!width && !!height && (
        <RN.FlatList
          ref={list}
          style={{ width, height }}
          data={photos}
          horizontal={true}
          pagingEnabled={true}
          keyExtractor={(photo) => photo.id}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={index}
          extraData={width}
          getItemLayout={(_, position) => ({
            length: width,
            offset: width * position,
            index: position,
          })}
          onMomentumScrollEnd={(event) => {
            const next = Math.round(event.nativeEvent.contentOffset.x / width);
            if (photos[next]) onSelect(photos[next]);
          }}
          renderItem={({ item }) => (
            <RN.View
              style={{
                width,
                height,
              }}
            >
              <ZoomablePhoto
                uri={uri(item.original_path)}
                key={item.id}
                onRepair={onRepair ? () => onRepair(item) : undefined}
              />
            </RN.View>
          )}
        />
      )}
    </RN.View>
  );
}
function ZoomablePhoto({ uri, onRepair }) {
  const [transform, setTransform] = React.useState({
    scale: 1,
    x: 0,
    y: 0,
  });
  const current = React.useRef(transform);
  const origin = React.useRef(transform);
  const distance = React.useRef(0);
  React.useEffect(() => {
    current.current = transform;
  }, [transform]);
  // create 只注册触摸回调，ref 的读写发生在实际触摸事件中。
  // eslint-disable-next-line react-hooks/refs
  const [responder] = React.useState(() =>
    RN.PanResponder.create({
      onStartShouldSetPanResponder: (event) =>
        event.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (event, gesture) =>
        event.nativeEvent.touches.length >= 2 ||
        (current.current.scale > 1 &&
          (Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3)),
      onPanResponderGrant: (event) => {
        origin.current = current.current;
        const [a, b] = event.nativeEvent.touches;
        distance.current = b
          ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY)
          : 0;
      },
      onPanResponderMove: (event, gesture) => {
        const [a, b] = event.nativeEvent.touches;
        if (b) {
          const nextDistance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          if (!distance.current) distance.current = nextDistance;
          setTransform({
            ...current.current,
            scale: Math.max(
              1,
              Math.min(
                4,
                (origin.current.scale * nextDistance) / distance.current,
              ),
            ),
          });
        } else if (current.current.scale > 1) {
          setTransform({
            ...current.current,
            x: origin.current.x + gesture.dx,
            y: origin.current.y + gesture.dy,
          });
        }
      },
      onPanResponderRelease: () => {
        if (current.current.scale < 1.05)
          setTransform({
            scale: 1,
            x: 0,
            y: 0,
          });
      },
    }),
  );
  return (
    <RN.View style={s.root} {...responder.panHandlers}>
      <LocalPhoto
        uri={uri}
        onRepair={onRepair}
        accessible
        accessibilityLabel="当前照片大图"
        resizeMode={"contain"}
        style={[
          s.image,
          {
            transform: [
              {
                translateX: transform.x,
              },
              {
                translateY: transform.y,
              },
              {
                scale: transform.scale,
              },
            ],
          },
        ]}
      />
    </RN.View>
  );
}
const s = RN.StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  message: {
    color: "#aaa",
    textAlign: "center",
    padding: 24,
  },
});
export { PhotoViewer };
