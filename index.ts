import { registerRootComponent } from "expo";
import App from "./App";

// 开发和原生打包均从实际业务源码启动，不再依赖遗留的不可编辑字节码。
registerRootComponent(App);
