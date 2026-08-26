import { AppRegistry, LogBox } from 'react-native';
import { App } from './src/App';
import { name as appName } from './app.json';

// Kepler's nested-<Text> warning is noisy and not actionable here.
LogBox.ignoreAllLogs();

AppRegistry.registerComponent(appName, () => App);
