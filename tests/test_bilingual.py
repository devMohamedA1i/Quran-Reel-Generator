import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import ayah_data
import quran_display as display
import renderer

@unittest.skipUnless(
    (ROOT / 'Assets' / 'Quran Text' / 'uthmani.json').is_file(),
    'Quran text assets are not bundled in source-only CI clone',
)
class BilingualTests(unittest.TestCase):
    def test_every_verse_pairs_without_changing_arabic(self):
        raw=ayah_data._uthmani(str(ROOT)); total=0
        for s,verses in raw.items():
            for verse in verses:
                result=display.display_verse(ROOT,int(s),verse['verse'],verse['text'],{'text_language':'en'})
                self.assertEqual(result['arabic'],verse['text'])
                self.assertTrue(result['english'])
                total+=1
        self.assertEqual(total,6236)

    def test_arabic_mode_keeps_exact_original_text(self):
        text=ayah_data.verse_text(ROOT,2,2)
        self.assertEqual(display.display_verse(ROOT,2,2,text,{'text_language':'ar'}),text)

    def test_optional_name_and_number_are_presentation_only(self):
        original=ayah_data.verse_text(ROOT,112,2)
        for lang in ('ar','en'):
            result=display.display_verse(ROOT,112,2,original,{
                'text_language':lang,'show_surah_name':True,'show_ayah_number':True})
            self.assertEqual(result['arabic'],original+' ﴿٢﴾')
            self.assertEqual(result['surah_name'],'سورة الإخلاص')
            self.assertEqual(ayah_data.verse_text(ROOT,112,2),original)
            renderer.build_overlay(ROOT,result,{'font_size':54})

    def test_number_can_be_hidden_in_english(self):
        result=display.display_verse(ROOT,112,2,ayah_data.verse_text(ROOT,112,2),{'text_language':'en'})
        self.assertNotIn('﴿',result['arabic'])
        self.assertFalse(result['english'].startswith('(2) '))
        self.assertNotIn('surah_name',result)

    def test_opening_has_surah_name_without_fictional_ayah_zero(self):
        result=display.opening_text(ROOT,{'surah':112,'text_language':'en','show_surah_name':True,'show_ayah_number':True})
        self.assertEqual(result['surah_name'],'سورة الإخلاص')
        self.assertNotIn('﴿',result['arabic'])

    def test_credit_is_metadata_without_visible_overlay_line(self):
        text=display.display_verse(ROOT,112,2,ayah_data.verse_text(ROOT,112,2),{'text_language':'en'})
        with_credit=renderer.build_overlay(ROOT,text,{'font_size':54})
        text.pop('credit')
        without_credit=renderer.build_overlay(ROOT,text,{'font_size':54})
        self.assertEqual(with_credit.tobytes(),without_credit.tobytes())
        metadata=renderer.translation_metadata(ROOT,{'text_language':'en'})
        self.assertIn('QuranEnc.com',metadata[1])
        self.assertIn('1.1.2',metadata[1])

    def test_wrong_arabic_is_not_paired(self):
        with self.assertRaises(ValueError):
            display.display_verse(ROOT,2,2,'غير مطابق',{'text_language':'en'})

    def test_opening_preview_and_tawbah_exception(self):
        opts={'surah':2,'reel_mode':True,'preview_time':1,'text_language':'en'}
        text,_=renderer.preview_text(ROOT,opts)
        self.assertEqual(text['arabic'],ayah_data.verse_text(ROOT,1,1))
        self.assertIsNone(display.opening_entry(ROOT,None,9))
        self.assertIsNone(display.opening_entry(ROOT,None,1))
        text,_=renderer.preview_text(ROOT,{**opts,'surah':9})
        self.assertIsInstance(text,str)

    def test_fatiha_first_verse_is_single_bismillah(self):
        text,_=renderer.preview_text(ROOT,{'surah':1,'reel_mode':True,'preview_time':4,'text_language':'en'})
        self.assertEqual(text['arabic'],ayah_data.verse_text(ROOT,1,1))

    def test_preview_can_reach_later_verse_with_end_one(self):
        text,_=renderer.preview_text(ROOT,{'surah':2,'reel_mode':True,'preview_time':15,'start':1,'end':1,'text_language':'en'})
        self.assertEqual(text['arabic'],ayah_data.verse_text(ROOT,2,2))

    def test_longest_verse_and_opening_fit_both_languages(self):
        for s,v in [(1,1),(2,255),(2,282),(112,1)]:
            text=display.display_verse(ROOT,s,v,ayah_data.verse_text(ROOT,s,v),{'text_language':'en'})
            image=renderer.build_overlay(ROOT,text,{'font_size':54})
            self.assertEqual(image.size,(720,1280))
            box=image.getbbox()
            self.assertGreaterEqual(box[1],75)
            self.assertLessEqual(box[3],1205)

    def test_export_preserves_full_audio_with_opening(self):
        parts=[];texts=[]
        def segment(bg,overlay,audio,clip,secs,*args,**kw):
            parts.append((args[1] if len(args)>1 else kw.get('audio_offset'),secs))
            Path(clip).write_bytes(b'fixture')
        def command(args):
            Path(args[-1]).write_bytes(b'fixture')
        with tempfile.TemporaryDirectory() as folder, \
             patch.object(renderer,'validate_settings',return_value={'kind':'image','path':'unused'}), \
             patch.object(renderer,'duration',return_value=100), \
             patch('reel_planner.master_audio',return_value=Path('fixture.wav')), \
             patch.object(renderer,'make_overlay',side_effect=lambda root,text,*a: texts.append(text)), \
             patch.object(renderer,'make_segment',side_effect=segment), \
             patch.object(renderer,'speech_windows',return_value=None), \
             patch.object(renderer,'command',side_effect=command):
            renderer.export_master_reel(ROOT,{'surah':2,'text_language':'en'},2,
                {'id':1,'start':0,'end':19},outdir=Path(folder),filename='fixture.mp4')
        self.assertAlmostEqual(sum(secs for _,secs in parts),19,places=3)
        self.assertEqual(texts[0]['arabic'],ayah_data.verse_text(ROOT,1,1))
        self.assertTrue(all(isinstance(t,dict) for t in texts))

    def test_short_opening_adds_three_seconds_without_losing_audio(self):
        parts=[];texts=[]
        def segment(bg,overlay,audio,clip,secs,*args,**kw):
            parts.append((args[1] if len(args)>1 else kw.get('audio_offset'),secs))
            Path(clip).write_bytes(b'fixture')
        def command(args):
            Path(args[-1]).write_bytes(b'fixture')
        with tempfile.TemporaryDirectory() as folder, \
             patch.object(renderer,'validate_settings',return_value={'kind':'image','path':'unused'}), \
             patch.object(renderer,'duration',return_value=100), \
             patch('reel_planner.master_audio',return_value=Path('fixture.wav')), \
             patch.object(renderer,'make_overlay',side_effect=lambda root,text,*a: texts.append(text)), \
             patch.object(renderer,'make_segment',side_effect=segment), \
             patch.object(renderer,'speech_windows',return_value=None), \
             patch.object(renderer,'command',side_effect=command):
            renderer.export_master_reel(ROOT,{'surah':112,'text_language':'en'},112,
                {'id':1,'start':0,'end':3},outdir=Path(folder),filename='fixture.mp4')
        self.assertAlmostEqual(sum(secs for _,secs in parts),6,places=3)
        self.assertEqual(texts[0]['arabic'],ayah_data.verse_text(ROOT,1,1))
        self.assertTrue(all(isinstance(t,dict) for t in texts))

if __name__=='__main__':unittest.main()
