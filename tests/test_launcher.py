import importlib.util
from pathlib import Path
from unittest.mock import MagicMock, patch

SCRIPT=Path(__file__).resolve().parents[1]/'scripts/start_app.py'
spec=importlib.util.spec_from_file_location('studio_launcher',SCRIPT)
launcher=importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


def test_existing_app_opens_default_browser_without_second_server():
    with patch.object(launcher,'ready',return_value=True), patch.object(launcher,'open_browser') as browser, patch.object(launcher.subprocess,'Popen') as spawn:
        assert launcher.main()==0
        browser.assert_called_once_with('http://127.0.0.1:5055/')
        spawn.assert_not_called()


def test_new_server_opens_browser_only_after_ready():
    process=MagicMock();process.poll.side_effect=[None,None,0];process.wait.return_value=0
    check=MagicMock();check.__enter__.return_value.connect_ex.return_value=111
    with patch.object(launcher,'ready',side_effect=[False,False,True]), patch.object(launcher.socket,'socket',return_value=check), patch.object(launcher.subprocess,'Popen',return_value=process) as spawn, patch.object(launcher,'open_browser') as browser, patch.object(launcher.time,'sleep'):
        assert launcher.main()==0
        browser.assert_called_once_with('http://127.0.0.1:5055/')
        assert spawn.call_args.kwargs['cwd']==str(launcher.ROOT)
        process.terminate.assert_not_called()


def test_occupied_port_is_not_replaced():
    check=MagicMock();check.__enter__.return_value.connect_ex.return_value=0
    with patch.object(launcher,'ready',return_value=False), patch.object(launcher.socket,'socket',return_value=check), patch.object(launcher.subprocess,'Popen') as spawn:
        try:
            launcher.main()
        except RuntimeError as error:
            assert 'another app' in str(error)
        else:
            raise AssertionError('Expected an occupied-port error')
        spawn.assert_not_called()
